export const globalSettings = {
  // retrieved from https://bitwarden.com/host.
  installation__id: '783b5a89-5ccd-436e-9893-ad3a0047b8d3',
  installation__key: 'G1CgBGSkUWIeiygk0gkY',
  // for YubiCloud Validation Service or Self-hosted Yubico Validation Server.
  yubico__clientId: 'REPLACE',
  yubico__key: 'REPLACE',
  //yubico__validationUrls__0: 'https://your.url.com/wsapi/2.0/verify',
  disableUserRegistration: false,
  // HaveIBeenPwned, available from https://haveibeenpwned.com/API/Key
  hibpApiKey: 'REPLACE',
};

export const adminSettings = {
  // Email addresses which may access the System Administrator Portal.
  admins: 'mats.kazuki@gmail.com',
};

export const webAclArn: string = 'arn:aws:wafv2:us-east-1:983035974902:global/webacl/BitwardenWebACL-NlsvLO3PmG33/913b80be-ecfa-4c3f-9254-a82f6f536879';
