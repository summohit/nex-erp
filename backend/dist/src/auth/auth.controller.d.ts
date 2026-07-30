import { AuthService } from './auth.service';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    signUp(signUpDto: Record<string, any>): Promise<{
        company: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            domain: string | null;
            logoUrl: string | null;
            industry: string | null;
            size: string | null;
            timezone: string | null;
            onboardingCompleted: boolean;
        };
        access_token: string;
    }>;
    signIn(signInDto: Record<string, any>): Promise<{
        access_token: string;
    }>;
}
