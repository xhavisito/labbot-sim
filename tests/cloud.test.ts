import { describe, expect, it } from 'vitest';
import { toCloudUser, usernameToEmail, validateCredentials } from '../src/net/cloud';

describe('cloud', () => {
  it('el usuario se normaliza y se convierte en un correo interno estable', () => {
    expect(usernameToEmail('  Ana_01 ')).toBe('ana_01@users.labbot-sim.app');
  });
  it('valida usuario y contraseña', () => {
    expect(validateCredentials('ana', '123456')).toBeNull();
    expect(validateCredentials('Ana.B-2', '123456')).toBeNull();
    expect(validateCredentials('a', '123456')).toBe('acct_badUser');
    expect(validateCredentials('ana pérez', '123456')).toBe('acct_badUser');
    expect(validateCredentials('x'.repeat(21), '123456')).toBe('acct_badUser');
    expect(validateCredentials('ana', '123')).toBe('acct_badPass');
  });
  it('toCloudUser prefiere el usuario guardado', () => {
    expect(toCloudUser(null)).toBeNull();
    expect(toCloudUser({ id: '1', email: 'ana@users.labbot-sim.app', user_metadata: { username: 'ana' } })).toEqual({ id: '1', email: 'ana@users.labbot-sim.app', name: 'ana' });
    expect(toCloudUser({ id: '2', email: 'beto@x.mx' })?.name).toBe('beto');
  });
});
