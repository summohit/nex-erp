#import <React/RCTBridgeModule.h>

// Exposes the Swift FieldVisitLocation class (same file basename) to the RN
// bridge. Swift's @objc-annotated members are visible here automatically via
// the target's generated -Swift.h header — no bridging header needed, since
// this direction (Obj-C calling Swift) doesn't require one.
@interface RCT_EXTERN_MODULE(FieldVisitLocation, NSObject)

RCT_EXTERN_METHOD(startTracking:(nonnull NSNumber *)visitId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stopTracking:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getBufferedPoints:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearBufferedPoints:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isTracking:(nonnull NSNumber *)visitId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
