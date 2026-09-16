import { PushService } from './push.service';

/**
 * What the browser is allowed to be told about Firebase.
 *
 * The server serves the web config so that setting Firebase up is one file on
 * the server rather than an Angular rebuild. The hazard that creates is that
 * the service account's PRIVATE KEY lives in the same file as those public
 * values — a single `...parsed` in the response would hand every signed-in user
 * the ability to push to every device in the project.
 *
 * getWebConfig therefore names its seven fields one by one, and these tests
 * exist to fail loudly the day somebody "simplifies" it into a spread.
 */
describe('PushService.getWebConfig', () => {
  const WEB = {
    apiKey: 'AIza-public',
    authDomain: 'demo.firebaseapp.com',
    projectId: 'demo',
    storageBucket: 'demo.appspot.com',
    messagingSenderId: '1234567890',
    appId: '1:1234:web:abcd',
    vapidKey: 'BJ-public-vapid',
  };

  const SERVICE_ACCOUNT = {
    type: 'service_account',
    project_id: 'demo',
    private_key: '-----BEGIN PRIVATE KEY-----NEVER-SERVE-THIS-----END PRIVATE KEY-----',
    private_key_id: 'key-id-secret',
    client_email: 'sdk@demo.iam.gserviceaccount.com',
  };

  /** The service with its config already loaded, without touching the disk. */
  const serviceWith = (web: any) => {
    const service = new PushService({} as any);
    (service as any).webConfig = web;
    return service;
  };

  it('returns the public values', () => {
    expect(serviceWith(WEB).getWebConfig()).toEqual({ enabled: true, config: WEB });
  });

  // The test that matters.
  it('never returns anything from the service account', () => {
    // The shape the file actually has on disk: both halves in one object.
    const service = serviceWith({ ...WEB, ...SERVICE_ACCOUNT });
    const json = JSON.stringify(service.getWebConfig());

    expect(json).not.toContain('PRIVATE KEY');
    expect(json).not.toContain('key-id-secret');
    expect(json).not.toContain('iam.gserviceaccount.com');
    for (const leaked of ['private_key', 'private_key_id', 'client_email', 'type']) {
      expect(json).not.toContain(`"${leaked}"`);
    }
  });

  it('returns exactly the seven public fields and nothing else', () => {
    const { config } = serviceWith({ ...WEB, ...SERVICE_ACCOUNT }).getWebConfig();
    expect(Object.keys(config!).sort()).toEqual(
      ['apiKey', 'appId', 'authDomain', 'messagingSenderId', 'projectId', 'storageBucket', 'vapidKey'],
    );
  });

  describe('when it is not configured', () => {
    it('reports disabled rather than half a config', () => {
      expect(serviceWith(null).getWebConfig()).toEqual({ enabled: false, config: null });
    });

    // getToken() returns null without a vapidKey and web push silently never
    // works, which is the hardest version of this to diagnose. Better to say
    // "not configured" than to hand the browser a config that cannot work.
    it.each(['vapidKey', 'projectId', 'messagingSenderId'])(
      'treats a missing %s as not configured',
      (field) => {
        const partial: any = { ...WEB, [field]: '' };
        expect(serviceWith(partial).getWebConfig().enabled).toBe(false);
      },
    );
  });
});
