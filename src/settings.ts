export const domainSettings = {
  zoneDomainName: 'example.com',
  subDomainName: 'bitwarden',
};

export const globalSettings = {
  globalSettings__installation__id: '00000000-0000-0000-0000-000000000000',
  globalSettings__installation__key: 'XXXXXXXXXXXXXXXXXXXX',
  // retrieved from https://bitwarden.com/host.
  // for YubiCloud Validation Service or Self-hosted Yubico Validation Server.
  globalSettings__yubico__clientId: 'REPLACE',
  globalSettings__yubico__key: 'REPLACE',
  globalSettings__disableUserRegistration: false,
  // HaveIBeenPwned, available from https://haveibeenpwned.com/API/Key
  globalSettings__hibpApiKey: 'REPLACE',
};

export const adminSettings = {
  adminSettings__admins: '',
  // Email addresses which may access the System Administrator Portal.
};
