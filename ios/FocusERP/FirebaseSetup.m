#import <Firebase/Firebase.h>
#import <FirebaseMessaging/FirebaseMessaging.h>

void RNFBConfigureFirebase(void) {
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
}

void RNFBSetAPNSToken(NSData *token) {
  [FIRMessaging messaging].APNSToken = token;
}
