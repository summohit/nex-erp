export declare class UploadController {
    uploadFile(file: Express.Multer.File): Promise<{
        url: string;
    }>;
}
