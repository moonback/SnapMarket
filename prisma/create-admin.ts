/**
 * Création sécurisée du premier administrateur (ou promotion d'un compte existant).
 *
 * Usage (accès direct à la base requis, donc réservé aux opérateurs) :
 *   npm run admin:create -- --email admin@exemple.fr --username admin
 * Le mot de passe est lu de façon masquée sur l'entrée standard, ou depuis la
 * variable ADMIN_INITIAL_PASSWORD (CI / conteneur). Il n'apparaît jamais en argument.
 * Pour promouvoir un compte existant : ajouter --promote.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createInterface } from 'node:readline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(question)) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function strong(pw: string): boolean {
  return (
    pw.length >= 14 &&
    /[a-z]/.test(pw) &&
    /[A-Z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const email = arg('email')?.trim().toLowerCase();
    const username = arg('username')?.trim();
    const promote = process.argv.includes('--promote');
    if (!email) throw new Error('--email requis');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (!promote)
        throw new Error(
          'Ce compte existe déjà. Ajoutez --promote pour le promouvoir administrateur.',
        );
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN', status: 'ACTIVE' },
      });
      await prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'admin.bootstrap_promote',
          entityType: 'User',
          entityId: existing.id,
          metadata: { via: 'cli' },
        },
      });
      console.log(`Compte ${email} promu administrateur.`);
      return;
    }
    if (!username || !/^[a-zA-Z0-9_.]{3,24}$/.test(username))
      throw new Error('--username valide requis');
    const password =
      process.env.ADMIN_INITIAL_PASSWORD ?? (await askHidden('Mot de passe administrateur : '));
    if (!strong(password)) {
      throw new Error(
        'Mot de passe trop faible : 14 caractères minimum avec minuscule, majuscule, chiffre et symbole.',
      );
    }
    const user = await prisma.user.create({
      data: {
        email,
        username,
        role: 'ADMIN',
        passwordHash: await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: null,
        action: 'admin.bootstrap_create',
        entityType: 'User',
        entityId: user.id,
        metadata: { via: 'cli' },
      },
    });
    console.log(`Administrateur ${email} créé.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
