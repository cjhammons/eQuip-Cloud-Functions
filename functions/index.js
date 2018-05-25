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

// Authenticate to Algolia Database.
const algoliasearch = require('algoliasearch');
const client = algoliasearch(functions.config().algolia.app_id, functions.config().algolia.api_key);

// Name fo the algolia index for Blog posts content.
const ALGOLIA_EQUIPMENT_INDEX_NAME = 'EQUIPMENT';
const ALGOLIA_VENDORS_INDEX_NAME = 'VENDORS';

/*-----------------------------------------------------------
                            CLOUD FUNCTIONS
  -----------------------------------------------------------*/

exports.generateThumbnail = functions.storage.object().onFinalize((object) => {

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
//
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
exports.onEquipmentReserved = functions.database.ref('/reservations/{reservationId}').onWrite((snapshot, context) => {
    const reservationId = context.params.reservationId;

    if (!snapshot.after.val()) {
      return console.log('Reservation removed');
    }
    console.log(snapshot.after);
    const reservation = snapshot.after.val();
    console.log('Reservation object:', reservation);

    const ownerId = reservation.ownerId;
    const borrowerId = reservation.borrowerId;
    const equipmentId = reservation.equipmentId;

    const getDeviceTokensPromise = admin.database().ref(`/users/${ownerId}/notificationTokens`).once('value');
    const getBorrowerProfilePromise = admin.database().ref(`/users/${borrowerId}`).once('value');
    const getEquipmentPromise = admin.database().ref(`/equipment/${equipmentId}`).once('value');

    let tokensSnapshot;
    let borrower;
    let equipment;

    let tokens;

    return Promise.all([getDeviceTokensPromise, getBorrowerProfilePromise, getEquipmentPromise]).then(results => {
      tokensSnapshot = results[0];
      borrowerSnapshot = results[1];
      equipmentSnapshot = results[2];

      if (!tokensSnapshot.hasChildren()) {
         return console.log('There are no notification tokens to send to.');
      }
      if (!borrowerSnapshot.hasChildren()) {
        return console.log('Borrower profile not found.');
      }
      if (!equipmentSnapshot.hasChildren) {
        return console.log('Equipment not found.');
      }

      const borrower = borrowerSnapshot.val();
      const equipment = equipmentSnapshot.val();

      console.log('There are', tokensSnapshot.numChildren(), 'tokens to send notifications to.');


      tokens = Object.keys(tokensSnapshot.val()).map((key) => {
        return tokensSnapshot.val()[key];
      });

      const payload = {
        notification: {
          title: 'Someone has requested a reservation!',
          body: `${borrower.displayName} wants to rent your ${equipment.name}!`
        }
      };

      return admin.messaging().sendToDevice(tokens, payload);
    }).then((response) => {
      // For each message check if there was an error.
        const tokensToRemove = [];
        response.results.forEach((result, index) => {
          const error = result.error;
          if (error) {
            console.error('Failure sending notification to', tokens[index], error);
            // Cleanup the tokens who are not registered anymore.
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
              tokensToRemove.push(tokensSnapshot.ref.child(tokens[index]).remove());
            }
          }
        });
        return Promise.all(tokensToRemove);
    }).catch((error) => {
      return console.log('Notification error', error);
    });
});


// Updates the search index when new blog entries are created or updated.
exports.indexEntry = functions.database.ref('/equipment/{equipmentId}').onWrite(event => {
  const index = client.initIndex(ALGOLIA_EQUIPMENT_INDEX_NAME);
  return index.addObject(event.data.val());
});

exports.deleteIndexEntry = functions.database.ref('/equipment/{equipmentId}').onDelete(event => {
  const index = client.initIndex(ALGOLIA_EQUIPMENT_INDEX_NAME);
  index.deleteObject((equipmentId), function(err){
    if (err) {
      console.log(equipmentId, "not deleted successfully");
    } else {
      console.log(equipmentId, "deleted");
    }
  });
});

/*-----------------------------------------------------------
                            HELPER FUNCTIONS
  -----------------------------------------------------------*/

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
