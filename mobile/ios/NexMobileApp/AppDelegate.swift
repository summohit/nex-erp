import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import RNBootSplash
import Firebase

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Firebase first, before React Native starts.
    //
    // @react-native-firebase/messaging expects a configured default app the
    // moment its native module initialises, and that happens during
    // startReactNative below. Configuring afterwards throws "No Firebase App
    // '[DEFAULT]' has been created".
    //
    // Guarded on the plist because it is per-project configuration that is not
    // in the repository: without it `FirebaseApp.configure()` crashes on
    // launch, which would make the whole app unrunnable for anyone who has not
    // set Firebase up yet. Push is off in that case; nothing else changes.
    if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
      FirebaseApp.configure()
    } else {
      NSLog("[firebase] GoogleService-Info.plist not found — push notifications disabled in this build.")
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "NexMobileApp",
      in: window,
      launchOptions: launchOptions
    )
    
    if let rootViewController = window?.rootViewController {
      RNBootSplash.initWithStoryboard("BootSplash", rootView: rootViewController.view)
    }

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
