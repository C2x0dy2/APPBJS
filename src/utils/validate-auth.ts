// Vérifications des formulaires de connexion et d'inscription, avant tout envoi au serveur.
// Mêmes règles que Supabase Auth (nom d'utilisateur, mot de passe) : le serveur revérifie toujours,
// ces contrôles servent seulement à donner une réponse immédiate à la personne.

export type AuthFormErrors = Record<string, string>;

export interface LoginForm {
  username: string;
  password: string;
}

export interface RegisterForm {
  username: string;
  email: string;
  password: string;
  passwordConfirm: string;
  acceptTerms: boolean;
  newsletter: boolean;
}

export const emptyRegisterForm: RegisterForm = {
  username: "",
  email: "",
  password: "",
  passwordConfirm: "",
  acceptTerms: false,
  newsletter: false,
};

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return "Saisis ton adresse e-mail.";
  // Volontairement simple : quelque chose, une arobase, quelque chose, un point, quelque chose.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Cette adresse e-mail n'a pas l'air valide.";
  return undefined;
}

export function validateLogin(form: LoginForm): AuthFormErrors {
  const errors: AuthFormErrors = {};
  if (!form.username.trim()) errors.username = "Saisis ton nom d'utilisateur.";
  if (!form.password) errors.password = "Saisis ton mot de passe.";
  return errors;
}

// Le défaut d'un nouveau mot de passe, ou undefined s'il convient. Le serveur applique ses propres critères (mots de passe
// courants, ressemblance avec le nom…) : ce contrôle ne sert qu'à répondre tout de suite.
function passwordProblem(password: string): string | undefined {
  if (!password) return "Choisis un mot de passe.";
  if (password.length < MIN_PASSWORD_LENGTH) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  if (/^\d+$/.test(password)) return "Le mot de passe ne peut pas être uniquement des chiffres.";
  return undefined;
}

// Choisir un nouveau mot de passe (lien « mot de passe oublié »).
export function validateNewPassword(password: string, passwordConfirm: string): AuthFormErrors {
  const errors: AuthFormErrors = {};
  const problem = passwordProblem(password);
  if (problem) errors.password = problem;
  else if (passwordConfirm !== password) errors.passwordConfirm = "Les deux mots de passe sont différents.";
  return errors;
}

export function validateRegister(form: RegisterForm): AuthFormErrors {
  const errors: AuthFormErrors = {};
  const username = form.username.trim();

  if (!username) errors.username = "Choisis un nom d'utilisateur.";
  else if (username.length < 3) errors.username = "Le nom d'utilisateur doit faire au moins 3 caractères.";
  else if (username.length > 30) errors.username = "Le nom d'utilisateur ne doit pas dépasser 30 caractères.";
  else if (!/^[\w.-]+$/.test(username)) errors.username = "Lettres, chiffres, point, tiret et tiret bas uniquement, sans espace.";

  const emailError = validateEmail(form.email);
  if (emailError) errors.email = emailError;

  const passwordError = passwordProblem(form.password);
  if (passwordError) errors.password = passwordError;
  else if (form.passwordConfirm !== form.password) errors.passwordConfirm = "Les deux mots de passe sont différents.";
  if (!form.acceptTerms) errors.acceptTerms = "Tu dois accepter les conditions pour créer un compte.";

  return errors;
}

// Force d'un mot de passe, de 0 (vide) à 4 (excellent), pour la jauge sous le champ.
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: "" };

  let score = 0;
  if (password.length >= MIN_PASSWORD_LENGTH) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  // Trop court : jamais mieux que "faible", quoi qu'il contienne.
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 1, label: "Trop court" };

  const labels = ["Faible", "Faible", "Moyen", "Bon", "Excellent"] as const;
  const clamped = Math.max(1, score) as 1 | 2 | 3 | 4;
  return { score: clamped, label: labels[clamped] };
}
