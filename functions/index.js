// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');
const gcs = require('@google-cloud/storage')();
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

exports.generateThumbnail = functions.storage.object().onChange(event => {
  const object = event.data; // The Storage object.

  const fileBucket = object.bucket; // The Storage bucket that contains the file.
  const filePath = object.name; // File path in the bucket.
  const contentType = object.contentType; // File content type.
  const resourceState = object.resourceState; // The resourceState is 'exists' or 'not_exists' (for file/folder deletions).
  const metageneration = object.metageneration; // Number of times metadata has been generated. New objects have a value of 1.

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('image/')) {
    console.log('This is not an image.');
    return;
  }

  // Get the file name.
  const fileName = path.basename(filePath);
  // Exit if the image is already a thumbnail.
  if (fileName.startsWith('thumbnail_')) {
    console.log('Already a Thumbnail.');
    return;
  }

  // Exit if this is a move or deletion event.
  if (resourceState === 'not_exists') {
    console.log('This is a deletion event.');
    return;
  }

  // Exit if file exists but is not new and is only being triggered
  // because of a metadata change.
  if (resourceState === 'exists' && metageneration > 1) {
    console.log('This is a metadata change event.');
    return;
  }
  // Download file from bucket.
  const bucket = gcs.bucket(fileBucket);
  const tempFilePath = path.join(os.tmpdir(), fileName);
  return bucket.file(filePath).download({
    destination: tempFilePath
  }).then(() => {
    console.log('Image downloaded locally to', tempFilePath);
    // Generate a thumbnail using ImageMagick.
    return spawn('convert', [tempFilePath, '-thumbnail', '200x200>', tempFilePath]);
  }).then(() => {
    console.log('Thumbnail created at', tempFilePath);
    // We add a 'thumb_' prefix to thumbnails file name. That's where we'll upload the thumbnail.
    const thumbFileName = `thumbnail_${fileName}`;
    const thumbFilePath = path.join(path.dirname(filePath), thumbFileName);
    // Uploading the thumbnail.
    return bucket.upload(tempFilePath, {destination: thumbFilePath});
  // Once the thumbnail has been uploaded delete the local file to free up disk space.
  }).then(() => fs.unlinkSync(tempFilePath));
});

//Based heavily on the sample firebase code found in this repo:
// https://github.com/firebase/functions-samples/tree/master/fcm-notifications
exports.onEquipmentReserved = functions.database.ref('/reservations/{reservationId}').onWrite(event => {
    const reservationId = event.params.reservationId;
    const reservation = event.data.current.val();
    const ownerId = reservation.ownerId;
    const borrowerId = reservation.borrowerId;
    const equipmentId = reservation.equipmentId;

    if (event.data.previous.exists()) {
      return;
    }
    //Check if reservation was made or removed, return if removed
    if (!event.data.val()) {
        return console.log('Reservation ', reservationId, 'removed');
    }

    return loadUsers().then(users => {
      let tokens = [];
      for (let user of users) {
        if (user.userId == ownerId) {
          for (let token of user.notificationTokens) {
            // var token = user.notificationTokens;
            if (token != "" && token != undefined) {
              console.log(user);
              tokens.push(token.toString());
              console.log('Token ', token);
            }
          }
        }  
      }

      let payload = {
        notification: {
          title: 'Reservation',
          body: 'Reservation Requested'
        }
      };
      console.log('Notifying: ', tokens)
      return admin.messaging().sendToDevice(tokens, payload);
    });
});

//calles loadUsers() and filters for a specific user
function getUser(userId) {
  return loadUsers().then(users => {
    for (let user of users) {
      if (user.userId == userId) {
        return user;
      } 
    };
  });
}

//Gets the users in the database
function loadUsers() {
  let userRef = admin.database().ref('/users');
  let defer = new Promise((resolve, reject) => {
		userRef.once('value', (snap) => {
			let data = snap.val();
      let users = [];
      for (var property in data) {
	      users.push(data[property]);
      }
			resolve(users);
		}, (err) => {
			reject(err);
		});
	});
	return defer;
}


