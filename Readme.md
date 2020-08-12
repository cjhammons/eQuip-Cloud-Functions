# eQuip Firebase Cloud Functions
eQuip used Firebase for all it's Database and file storage needs. In order to implement some of our features we needed more complex backend functionality, so we made use of Firebase's Cloud Function feature to implement these. 

The functions can be found in ``functions/index.js``

You can find the main Android app [here](https://github.com/cjhammons/eQuip-Android)

### Technologies used
- nodeJS
- Firebase
- Algolia
- Javascript promises

## eQuip's Premise

The premise of eQuip was to allow users to list their unused outdoor equipment (our initial focus was on kayaks and bikes in particular) for rental to other users. 

## Functions

- ``generateThumbnail``: When a user uploads a picture of their equipment we generated a smaller image, a thumbnail, for display in a list. 
- ``onReservationReserved``: This function triggers when a new reservation is requested. It would send a notification to the owner's device informing them of the reservation, and they could then confirm or deny the request,
- ``indexEntry``: We used a third party plugin called Algolia to handle our searches. This function triggers when a new equipment listing is added and adds it to our Algolia index so that it can be searched.
- ``deleteIndexEntry``: This is another Algolia function. When an equipment listing is deleted, this function will trigger and remove the listing from Algolia's index so that it can no longer be searched.
