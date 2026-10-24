import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, Public } from '../common/decorators/auth.decorators';
import { SearchProductsDto } from '../products/dto/product.dto';
import { ProductsService } from '../products/products.service';

/**
 * Flux « Découvrir » — classement v1, déterministe et documenté :
 *  1. Seules les annonces publiquement visibles (actives ou réservées, non modérées,
 *     vendeur actif) sont retenues.
 *  2. Les annonces de l'utilisateur et des comptes bloqués (dans les deux sens) sont exclues.
 *  3. Les filtres explicites (recherche, catégorie, prix, état, livraison, lieu) sont appliqués.
 *  4. Tri par date de publication décroissante puis identifiant (stable, paginé par curseur),
 *     ou par prix si l'utilisateur le demande.
 * Aucun profilage comportemental n'est utilisé.
 */
@ApiTags('feed')
@ApiBearerAuth()
@Controller('feed')
export class FeedController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Flux de découverte (classement déterministe documenté)' })
  feed(@Query() query: SearchProductsDto, @CurrentUser() user?: AuthUser) {
    return this.products.search(query, user, true);
  }
}
