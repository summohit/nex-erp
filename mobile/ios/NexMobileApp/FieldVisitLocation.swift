import Foundation
import CoreLocation
import React

/// Keeps recording a field visit's GPS route while the app is backgrounded or
/// the screen is locked. Mirrors android/.../fieldvisit/FieldVisitLocationService.kt
/// — same buffered-points model, same method names, so the JS bridge in
/// mobile/src/native/fieldVisitLocation.ts stays platform-agnostic.
///
/// Points are buffered in UserDefaults rather than pushed to JS via an event,
/// because the JS runtime can itself be suspended in background; the buffer
/// must outlive it. The RN side drains it with `getBufferedPoints()` whenever
/// the app is next foregrounded.
///
/// The location manager is created eagerly (not lazily inside startTracking)
/// so that if iOS relaunches the app in the background purely to deliver a
/// location update, the delegate is already wired up to receive it — the
/// `activeVisitId` persisted in UserDefaults is what tells `didUpdateLocations`
/// whether a visit is actually still in progress after such a relaunch.
@objc(FieldVisitLocation)
class FieldVisitLocation: NSObject, CLLocationManagerDelegate {

  private static let defaultsSuite = "field_visit_tracking"
  private static let keyPoints = "points"
  private static let keyVisitId = "visit_id"

  private let defaults = UserDefaults(suiteName: FieldVisitLocation.defaultsSuite) ?? .standard
  private lazy var locationManager: CLLocationManager = {
    let manager = CLLocationManager()
    manager.delegate = self
    // Route-tracing accuracy, not turn-by-turn — far cheaper on battery than
    // kCLLocationAccuracyBest for something that may run for hours.
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.distanceFilter = 15 // meters — mirrors the Android smallestDisplacement
    manager.allowsBackgroundLocationUpdates = true
    // Default is true, and would silently stop the trail whenever iOS decides
    // the user "looks stationary" — exactly the case (parked, walking a site)
    // a field visit needs to keep recording through.
    manager.pausesLocationUpdatesAutomatically = false
    if #available(iOS 11.0, *) {
      manager.showsBackgroundLocationIndicator = true
    }
    return manager
  }()

  override init() {
    super.init()
    // Force the lazy manager to initialize on module load so a background
    // relaunch-for-location-event has a delegate ready immediately.
    _ = locationManager
  }

  @objc
  static func requiresMainQueueSetup() -> Bool { true }

  // MARK: - Bridge methods (mirror FieldVisitLocationModule.kt)

  @objc(startTracking:resolver:rejecter:)
  func startTracking(
    _ visitId: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    defaults.set(visitId.int64Value, forKey: FieldVisitLocation.keyVisitId)

    let status: CLAuthorizationStatus
    if #available(iOS 14.0, *) {
      status = locationManager.authorizationStatus
    } else {
      status = CLLocationManager.authorizationStatus()
    }

    switch status {
    case .authorizedAlways:
      locationManager.startUpdatingLocation()
      resolve(true)
    case .authorizedWhenInUse:
      // "Always" can only be requested contextually, after "When In Use" is
      // already granted — this is that moment (a visit is actually starting).
      // The OS prompt result arrives async via the delegate below; foreground
      // tracking still works immediately via startUpdatingLocation() so the
      // visit is not blocked on the user answering the upgrade prompt.
      locationManager.requestAlwaysAuthorization()
      locationManager.startUpdatingLocation()
      resolve(true)
    case .notDetermined:
      locationManager.requestWhenInUseAuthorization()
      locationManager.startUpdatingLocation()
      resolve(true)
    default:
      reject("permission_denied", "Location permission is required to start a field visit.", nil)
    }
  }

  @objc(stopTracking:rejecter:)
  func stopTracking(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    locationManager.stopUpdatingLocation()
    defaults.removeObject(forKey: FieldVisitLocation.keyVisitId)
    resolve(true)
  }

  @objc(getBufferedPoints:rejecter:)
  func getBufferedPoints(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(defaults.array(forKey: FieldVisitLocation.keyPoints) ?? [])
  }

  @objc(clearBufferedPoints:rejecter:)
  func clearBufferedPoints(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    defaults.removeObject(forKey: FieldVisitLocation.keyPoints)
    resolve(true)
  }

  @objc(isTracking:resolver:rejecter:)
  func isTracking(
    _ visitId: NSNumber,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let active = defaults.object(forKey: FieldVisitLocation.keyVisitId) as? Int64
    resolve(active != nil && active == visitId.int64Value)
  }

  // MARK: - CLLocationManagerDelegate

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // Nothing to record if no visit is active — covers the app being
    // relaunched in the background for a stray location event after a visit
    // already ended.
    guard defaults.object(forKey: FieldVisitLocation.keyVisitId) != nil,
          let location = locations.last else { return }

    var points = defaults.array(forKey: FieldVisitLocation.keyPoints) as? [[Double]] ?? []
    points.append([
      location.coordinate.latitude,
      location.coordinate.longitude,
      location.timestamp.timeIntervalSince1970 * 1000,
    ])
    defaults.set(points, forKey: FieldVisitLocation.keyPoints)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Transient GPS errors are expected in background tracking (tunnels,
    // elevators) — CLLocationManager keeps retrying on its own, nothing to do.
  }
}
