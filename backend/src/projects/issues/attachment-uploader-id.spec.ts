import { BadRequestException } from '@nestjs/common';
import { IssuesController } from './issues.controller';

/**
 * IssueAttachment.uploadedBy foreign-keys to Employee.id, but both attachment
 * endpoints used to pass req.user.sub -- a User id. The two are different
 * numbers, and in this company's data they coincide for 95 of 98 accounts, so
 * the bug only ever surfaced for the handful of people whose ids had drifted
 * apart: ImageKit accepted the file, then the row insert died on the foreign
 * key and the user got a 500.
 */
function makeController() {
  const service: any = {
    uploadAttachmentToImageKit: jest.fn().mockResolvedValue({ id: 1 }),
    addLinkAttachment: jest.fn().mockResolvedValue({ id: 2 }),
  };
  return { controller: new IssuesController(service), service };
}

/** Richard Roe in production: user 103, employee 99. */
const req = (over: any = {}) => ({ user: { companyId: 1, sub: 103, employeeId: 99, ...over } });
const file: any = { originalname: 'scan.pdf', buffer: Buffer.from('x'), size: 1 };

describe('attachments are owned by the employee, not the user', () => {
  it('passes the employee id when uploading a file', async () => {
    const { controller, service } = makeController();
    await controller.uploadAttachment(req(), 7, 11, { files: [file] }, undefined);

    const [, passedId] = service.uploadAttachmentToImageKit.mock.calls[0];
    expect(passedId).toBe(99);
    expect(passedId).not.toBe(103);
  });

  it('passes the employee id when adding a link', async () => {
    const { controller, service } = makeController();
    await controller.addLinkAttachment(req(), 7, 11, { linkUrl: 'example.com' } as any);

    const [, passedId] = service.addLinkAttachment.mock.calls[0];
    expect(passedId).toBe(99);
  });

  it('refuses rather than writing a user id when there is no employee record', async () => {
    // The old `?? req.user.sub` fallback would have written 103 here, which is
    // either a foreign key violation or -- worse, once employee ids reach that
    // range -- somebody else's attachment.
    const { controller, service } = makeController();

    await expect(
      controller.uploadAttachment(req({ employeeId: null }), 7, 11, { files: [file] }, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.uploadAttachmentToImageKit).not.toHaveBeenCalled();
  });
});
