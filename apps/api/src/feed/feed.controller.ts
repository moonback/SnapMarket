import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { SearchProductsDto } from '../products/dto/product.dto';
import { ProductsService } from '../products/products.service';
import { PersonalizationService } from './personalization.service';

/**
 * Flux « Découvrir » :
 *  1. Seules les annonces publiquement visibles (actives ou réservées, non modérées,
 *     vendeur actif) sont retenues.
 *  2. Les annonces de l'utilisateur et des comptes bloqués (dans les deux sens) sont exclues.
 *  3. Les filtres explicites (recherche, catégorie, prix, état, livraison, lieu) sont appliqués.
 *  4. Tri par défaut « Pour vous » pour un utilisateur connecté ayant laissé la personnalisation
 *     active (voir PersonalizationService : signaux explicites, score stable et explicable),
 *     sinon par date de publication ; tri par prix sur demande.
 */
@ApiTags('feed')
@ApiBearerAuth()
@Controller('feed')
export class FeedController {
  constructor(
    private readonly products: ProductsService,
    private readonly personalization: PersonalizationService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Flux de découverte (classement documenté, « Pour vous » par défaut si connecté)',
  })
  feed(@Query() query: SearchProductsDto, @CurrentUser() user?: AuthUser) {
    return this.products.search({ ...query, sort: query.sort ?? 'for_you' }, user, true);
  }

  /** Signaux utilisés pour le classement personnalisé (transparence). */
  @Get('personalization')
  @ApiOperation({ summary: 'Signaux du flux « Pour vous » de l’utilisateur' })
  personalizationInfo(@CurrentUser() user: AuthUser) {
    return this.personalization.describe(user.id);
  }
}
