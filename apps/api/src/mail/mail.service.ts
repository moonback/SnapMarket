import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import nodemailer, { Transporter } from 'nodemailer';
import { APP_CONFIG, AppConfig } from '../config/configuration';
import { EmailJob, QUEUE_EMAIL } from '../queue/queues';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(QUEUE_EMAIL) private readonly queue: Queue<EmailJob>,
  ) {}

  get configured(): boolean {
    return this.config.smtp.host !== null;
  }

  /** Met l'email en file d'attente (envoyé par le worker, avec reprises). */
  async enqueue(job: EmailJob): Promise<void> {
    if (!this.configured) {
      this.logger.warn(`SMTP non configuré : email « ${job.subject} » non envoyé`);
      return;
    }
    await this.queue.add('send', job);
  }

  /** Envoi effectif, appelé par le worker. */
  async send(job: EmailJob): Promise<void> {
    if (!this.configured) throw new Error('SMTP non configuré');
    if (!this.transporter) {
      const { host, port, secure, user, password } = this.config.smtp;
      this.transporter = nodemailer.createTransport({
        host: host!,
        port,
        secure,
        auth: user ? { user, pass: password ?? '' } : undefined,
      });
    }
    await this.transporter.sendMail({ from: this.config.smtp.from, ...job });
  }

  verificationEmail(to: string, link: string): EmailJob {
    return {
      to,
      subject: 'Confirmez votre adresse email SnapMarket',
      text: `Bienvenue sur SnapMarket !\n\nConfirmez votre adresse email en ouvrant ce lien (valable 24 heures) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
    };
  }

  resetPasswordEmail(to: string, link: string): EmailJob {
    return {
      to,
      subject: 'Réinitialisation de votre mot de passe SnapMarket',
      text: `Une réinitialisation du mot de passe a été demandée pour votre compte.\n\nOuvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
    };
  }
}
