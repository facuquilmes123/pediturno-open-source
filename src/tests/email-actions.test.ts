import { describe, expect, it } from 'vitest';
import { emailActionIssue, parseEmailAction } from '@/lib/email-actions';

describe('email action link boundary', () => {
  it.each(['resetPassword', 'verifyEmail', 'recoverEmail', 'verifyAndChangeEmail'])('recognizes only the supported action %s', mode => {
    expect(parseEmailAction('?mode=' + mode + '&oobCode=synthetic-code&apiKey=untrusted-key')).toEqual({ mode, code: 'synthetic-code', returnUrl: 'https://pediturno.com/?login=1' });
  });
  it.each(['', '?mode=signIn&oobCode=test', '?mode=verifyEmail', '?mode=verifyEmail&oobCode=', '?mode=verifyEmail&mode=recoverEmail&oobCode=test', '?mode=verifyEmail&oobCode=a&oobCode=b', '?mode=verifyEmail&oobCode=a%0Ab', '?mode=verifyEmail&oobCode=test&tenantId=other'])('rejects incomplete or ambiguous input %s', search => expect(parseEmailAction(search)).toBeNull());
  it('bounds the one-time code without logging or returning query parameters', () => {
    expect(parseEmailAction('?mode=verifyEmail&oobCode=' + 'a'.repeat(2049))).toBeNull();
    const result = parseEmailAction('?mode=verifyEmail&oobCode=synthetic-code&continueUrl=' + encodeURIComponent('https://pediturno.com/dashboard?oobCode=do-not-forward#fragment'));
    expect(result?.returnUrl).toBe('https://pediturno.com/?login=1');
  });
  it.each(['https://evil.example', 'https://pediturno.com.evil.example', 'https://user:password@pediturno.com/', 'http://pediturno.com/', 'https://pediturno.com:8443/', 'javascript:alert(1)', '//evil.example'])('does not redirect to %s', url => {
    expect(parseEmailAction('?mode=verifyEmail&oobCode=synthetic&continueUrl=' + encodeURIComponent(url))?.returnUrl).toBe('https://pediturno.com/?login=1');
  });
  it.each(['https://canchas.pediturno.com', 'https://espacios.pediturno.com'])('keeps a trusted sibling portal without publishing its app: %s', origin => {
    expect(parseEmailAction('?mode=verifyEmail&oobCode=synthetic&continueUrl=' + encodeURIComponent(origin + '/dashboard?token=private'))?.returnUrl).toBe(origin + '/?login=1');
  });
  it('maps provider failures without exposing raw messages', () => {
    expect(emailActionIssue({ code: 'auth/invalid-action-code', message: 'private-code' })).toMatchObject({ retryable: false });
    expect(emailActionIssue({ code: 'auth/weak-password' })).toMatchObject({ retryable: false });
    expect(emailActionIssue({ code: 'auth/internal-error', message: 'private-code' })).toMatchObject({ retryable: true });
    expect(JSON.stringify(emailActionIssue(new Error('private-code')))).not.toContain('private-code');
  });
});
