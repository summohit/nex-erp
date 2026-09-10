/**
 * Session-refresh behaviour of the API client.
 *
 * apiClient imports only axios and the auth store, so mocking those two keeps
 * the React Native module tree out of this suite entirely.
 */

const mockCreated: any[] = [];

jest.mock('axios', () => {
  const makeInstance = () => {
    // Calling an axios instance re-issues a request — that is how the
    // interceptor retries the original call.
    const instance: any = jest.fn(async () => ({ data: 'retried' }));
    instance.post = jest.fn();
    instance.interceptors = {
      request: { use: jest.fn() },
      response: {
        use: jest.fn((_ok: any, onError: any) => {
          instance.__onError = onError;
        }),
      },
    };
    return instance;
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => {
        const instance = makeInstance();
        mockCreated.push(instance);
        return instance;
      }),
    },
  };
});

const mockState = {
  token: 'old-access',
  refreshToken: 'refresh-1',
  setTokens: jest.fn(),
  logout: jest.fn(),
};

jest.mock('../src/store/authStore', () => ({
  useAuthStore: { getState: () => mockState },
}));

require('../src/api/apiClient');

const [client, refreshClient] = mockCreated;
const onError = (client as any).__onError;

const unauthorized = (url: string) => ({
  response: { status: 401, data: {} },
  config: { url, headers: {} },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState.token = 'old-access';
  mockState.refreshToken = 'refresh-1';
});

describe('401 handling', () => {
  it('refreshes and retries the original request', async () => {
    refreshClient.post.mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'refresh-2' },
    });

    const result = await onError(unauthorized('/field-visits/active'));

    expect(refreshClient.post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-1' });
    // The rotated refresh token must be stored, or the next refresh presents a
    // token the server has already retired.
    expect(mockState.setTokens).toHaveBeenCalledWith('new-access', 'refresh-2');
    expect(client).toHaveBeenCalledTimes(1);
    expect(client.mock.calls[0][0].headers.Authorization).toBe('Bearer new-access');
    expect(mockState.logout).not.toHaveBeenCalled();
    expect(result).toEqual({ data: 'retried' });
  });

  it('refreshes only once for requests that fail together', async () => {
    let resolveRefresh: (v: any) => void = () => {};
    refreshClient.post.mockReturnValue(new Promise((r) => { resolveRefresh = r; }));

    const inFlight = [
      onError(unauthorized('/dashboard')),
      onError(unauthorized('/notifications')),
      onError(unauthorized('/field-visits/active')),
    ];

    resolveRefresh({ data: { access_token: 'new-access', refresh_token: 'refresh-2' } });
    await Promise.all(inFlight);

    // Three failures, one refresh: the server retires the token on each call,
    // so parallel refreshes would spend it and log the user out.
    expect(refreshClient.post).toHaveBeenCalledTimes(1);
    expect(client).toHaveBeenCalledTimes(3);
  });

  it('logs out when the refresh token is rejected', async () => {
    refreshClient.post.mockRejectedValue({ response: { status: 401 } });

    await expect(onError(unauthorized('/dashboard'))).rejects.toBeDefined();

    expect(mockState.logout).toHaveBeenCalledTimes(1);
    expect(client).not.toHaveBeenCalled();
  });

  it('logs out when there is no refresh token to use', async () => {
    mockState.refreshToken = null as any;

    await expect(onError(unauthorized('/dashboard'))).rejects.toBeDefined();

    expect(refreshClient.post).not.toHaveBeenCalled();
    expect(mockState.logout).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a rejected two-factor code', async () => {
    // A wrong code answers 401 by design. Refreshing and retrying would be
    // meaningless, and logging the user out mid sign-in would strand them.
    await expect(onError(unauthorized('/auth/2fa/challenge/verify'))).rejects.toBeDefined();

    expect(refreshClient.post).not.toHaveBeenCalled();
    expect(mockState.logout).not.toHaveBeenCalled();
  });

  it('still refreshes for the AUTHENTICATED 2fa routes', async () => {
    refreshClient.post.mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'refresh-2' },
    });

    // Only /auth/2fa/challenge is excluded. The Security screen's calls answer
    // 403 for a wrong code, so a 401 there really is an expired session.
    await onError(unauthorized('/auth/2fa/status'));

    expect(refreshClient.post).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on a failed login — those credentials were simply wrong', async () => {
    await expect(onError(unauthorized('/auth/login'))).rejects.toBeDefined();

    expect(refreshClient.post).not.toHaveBeenCalled();
    expect(mockState.logout).not.toHaveBeenCalled();
  });

  it('retries a given request only once', async () => {
    refreshClient.post.mockResolvedValue({
      data: { access_token: 'new-access', refresh_token: 'refresh-2' },
    });

    const alreadyRetried = {
      response: { status: 401, data: {} },
      config: { url: '/dashboard', headers: {}, _retry: true },
    };
    await expect(onError(alreadyRetried)).rejects.toBeDefined();

    // A token the server keeps rejecting must not spin the refresh loop.
    expect(refreshClient.post).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled();
  });

  it('leaves non-401 failures alone', async () => {
    const serverError = { response: { status: 500, data: {} }, config: { url: '/dashboard', headers: {} } };

    await expect(onError(serverError)).rejects.toBe(serverError);

    expect(refreshClient.post).not.toHaveBeenCalled();
    expect(mockState.logout).not.toHaveBeenCalled();
  });
});
