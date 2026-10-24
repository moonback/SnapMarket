import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from '../categories/categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../categories/dto/category.dto';
import { AuthUser, CurrentUser, Roles } from '../common/decorators/auth.decorators';
import { SettingsService } from '../settings/settings.service';
import { AdminService } from './admin.service';
import {
  AdminOrdersQuery,
  AdminProductsQuery,
  AdminUsersQuery,
  AuditQuery,
  ContentModerationDto,
  ContentTypeParam,
  DisputesQuery,
  PageQueryDto,
  ReasonDto,
  ReportsQuery,
  ResolveDisputeDto,
  ResolveReportDto,
  SellerDecisionDto,
  SellersQuery,
  UserRoleDto,
  UserStatusDto,
} from './dto/admin.dto';

/**
 * Administration. Toutes les routes exigent MODERATOR ou ADMIN ; les opérations
 * financières, les rôles, les catégories, l'audit et les paramètres sont réservés à ADMIN.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN', 'MODERATOR')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly categories: CategoriesService,
    private readonly settings: SettingsService,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return { id: user.id, role: user.role };
  }

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('users')
  users(@Query() q: AdminUsersQuery) {
    return this.admin.users(q);
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.admin.userDetail(id);
  }

  @Post('users/:id/status')
  @HttpCode(200)
  userStatus(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UserStatusDto) {
    return this.admin.setUserStatus(actor, id, dto);
  }

  @Roles('ADMIN')
  @Post('users/:id/role')
  @HttpCode(200)
  userRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: UserRoleDto) {
    return this.admin.setUserRole(actor, id, dto);
  }

  @Get('sellers')
  sellers(@Query() q: SellersQuery) {
    return this.admin.sellers(q);
  }

  @Post('sellers/:userId/decision')
  @HttpCode(200)
  sellerDecision(
    @CurrentUser() actor: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: SellerDecisionDto,
  ) {
    return this.admin.decideSeller(actor, userId, dto);
  }

  @Get('products')
  products(@Query() q: AdminProductsQuery) {
    return this.admin.products(q);
  }

  @Get('messages/flagged')
  flagged(@Query() q: PageQueryDto) {
    return this.admin.flaggedMessages(q);
  }

  @Post('content/:type/:id/moderation')
  @HttpCode(204)
  moderate(
    @CurrentUser() actor: AuthUser,
    @Param() params: ContentTypeParam,
    @Body() dto: ContentModerationDto,
  ) {
    return this.admin.moderate(actor, params.type, params.id, dto);
  }

  @Get('categories')
  listCategories() {
    return this.categories.list(true);
  }

  @Roles('ADMIN')
  @Post('categories')
  createCategory(@CurrentUser() actor: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(dto, actor.id);
  }

  @Roles('ADMIN')
  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto, actor.id);
  }

  @Get('orders')
  orders(@Query() q: AdminOrdersQuery) {
    return this.admin.orderList(q);
  }

  @Get('orders/:id')
  order(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.admin.orderDetail(actor, id);
  }

  @Roles('ADMIN')
  @Post('orders/:id/refund')
  @HttpCode(200)
  refund(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.admin.refundOrder(actor, id, dto.reason ?? 'Remboursement par l’administration');
  }

  @Get('disputes')
  disputes(@Query() q: DisputesQuery) {
    return this.admin.disputes(q);
  }

  @Roles('ADMIN')
  @Post('disputes/:id/resolve')
  @HttpCode(200)
  resolveDispute(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.admin.resolveDispute(actor, id, dto);
  }

  @Get('reports')
  reports(@Query() q: ReportsQuery) {
    return this.admin.reports(q);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  resolveReport(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.admin.resolveReport(actor, id, dto);
  }

  @Roles('ADMIN')
  @Get('audit-logs')
  audit(@Query() q: AuditQuery) {
    return this.admin.auditLogs(q);
  }

  @Roles('ADMIN')
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(@CurrentUser() actor: AuthUser, @Body() patch: Record<string, unknown>) {
    return this.settings.update(patch, actor.id);
  }
}
