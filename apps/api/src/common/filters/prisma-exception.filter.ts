import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Traduit les erreurs Prisma connues en réponses HTTP sans divulguer de détails internes. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erreur interne';
    switch (exception.code) {
      case 'P2002':
        status = HttpStatus.CONFLICT;
        message = 'Cette ressource existe déjà';
        break;
      case 'P2025':
        status = HttpStatus.NOT_FOUND;
        message = 'Ressource introuvable';
        break;
      case 'P2003':
        status = HttpStatus.BAD_REQUEST;
        message = 'Référence invalide';
        break;
      default:
        this.logger.error(exception.message);
    }
    res.status(status).json({ statusCode: status, error: HttpStatus[status], message });
  }
}
