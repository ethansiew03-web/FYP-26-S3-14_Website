/*
 * Password rules for the website. Mirrors the BioAudit app and server
 * (bioaudit/password_policy.py and backend/src/utils/passwordPolicy.js), so a password
 * accepted here is accepted in the app. If those change, change this file too.
 *
 * passwordProblem(password) returns what is wrong, or null when the password is fine.
 */

const MIN_LENGTH = 12;

const COMMON = new Set([
  "password",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "qwerty",
  "qwertyuiop",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "iloveyou",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "abc123",
  "trustno1",
  "sunshine",
  "princess",
  "changeme",
  "bioaudit",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "111111",
  "000000",
  "asdfgh",
  "zxcvbn",
  "starwars",
  "whatever",
  "freedom",
  "master",
  "login",
  "hello",
]);
// Words of 6+ letters are also rejected when they are all the password's letters ("Password1!")
const COMMON_WORDS = new Set([...COMMON].filter((word) => /^[a-z]{6,}$/.test(word)));

export function passwordProblem(password) {
  if (password.length < MIN_LENGTH) return "Use at least " + MIN_LENGTH + " characters.";
  if (password.length > 128) return "That password is too long.";
  if (!/\p{Ll}/u.test(password)) return "Add a lowercase letter.";
  if (!/\p{Lu}/u.test(password)) return "Add an uppercase letter.";
  if (!/\d/.test(password)) return "Add a digit.";
  if (!/[^\p{L}\d]/u.test(password)) return "Add a symbol (such as ! ? # $).";
  const letters = password.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (COMMON_WORDS.has(letters) || COMMON.has(password.toLowerCase()) || new Set(password).size <= 3) {
    return "That password is too common. Choose something less guessable.";
  }
  return null;
}
