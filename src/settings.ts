export const globalSettings = {
  // retrieved from https://bitwarden.com/host.
  installation__id: '00000000-0000-0000-0000-000000000000',
  installation__key: 'XXXXXXXXXXXXXXXXXXXX',
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
  admins: '',
};

export const webAclArn: string = 'REPLACE'
