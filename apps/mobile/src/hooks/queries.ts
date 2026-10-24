import {
  InfiniteData,
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  CategoryDto,
  ConversationDto,
  MessageDto,
  NotificationDto,
  OfferDto,
  OrderDto,
  Paginated,
  PlatformStatus,
  ProductDetail,
  ProductSummary,
  PublicUser,
  ReviewDto,
  StoryGroupDto,
} from '@snapmarket/shared';
import { api } from '../services/api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export interface FeedFilters {
  q?: string;
  categoryId?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  conditions?: string[];
  deliveryMode?: 'SHIPPING' | 'MEETUP';
  department?: string;
  sort?: 'recent' | 'price_asc' | 'price_desc';
}

const nextCursor = <T>(last: Paginated<T>) => last.nextCursor ?? undefined;

export const keys = {
  status: ['status'] as const,
  categories: ['categories'] as const,
  feed: (f: FeedFilters) => ['feed', f] as const,
  product: (id: string) => ['product', id] as const,
  favorites: ['favorites'] as const,
  stories: ['stories'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  unread: ['unread'] as const,
  orders: (role: 'buyer' | 'seller') => ['orders', role] as const,
  order: (id: string) => ['order', id] as const,
  notifications: ['notifications'] as const,
  user: (id: string) => ['user', id] as const,
  userProducts: (id: string) => ['userProducts', id] as const,
  sold: (id: string) => ['sold', id] as const,
  reviews: (id: string) => ['reviews', id] as const,
  myProducts: (status?: string) => ['myProducts', status ?? 'all'] as const,
  offers: (role: 'buyer' | 'seller', productId?: string) =>
    ['offers', role, productId ?? 'all'] as const,
};

export const useStatus = () =>
  useQuery({
    queryKey: keys.status,
    queryFn: () => api.request<PlatformStatus>('/status', { auth: false }),
    staleTime: 300_000,
  });

export const useCategories = () =>
  useQuery({
    queryKey: keys.categories,
    queryFn: () => api.request<CategoryDto[]>('/categories', { auth: false }),
    staleTime: 3_600_000,
  });

export const useFeed = (filters: FeedFilters) =>
  useInfiniteQuery({
    queryKey: keys.feed(filters),
    queryFn: ({ pageParam }) =>
      api.request<Paginated<ProductSummary>>('/feed', {
        query: { ...filters, cursor: pageParam, limit: 20 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

export const useProduct = (id: string) =>
  useQuery({
    queryKey: keys.product(id),
    queryFn: () => api.request<ProductDetail>(`/products/${id}`),
  });

export const useFavorites = () =>
  useInfiniteQuery({
    queryKey: keys.favorites,
    queryFn: ({ pageParam }) =>
      api.request<Paginated<ProductSummary>>('/favorites', { query: { cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

/** Favori avec mise à jour optimiste de toutes les listes en cache. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, favorite }: { productId: string; favorite: boolean }) =>
      api.request(`/favorites/${productId}`, { method: favorite ? 'PUT' : 'DELETE' }),
    onMutate: ({ productId, favorite }) => {
      const patch = <T extends { id: string; isFavorite: boolean }>(p: T): T =>
        p.id === productId ? { ...p, isFavorite: favorite } : p;
      qc.setQueriesData<InfiniteData<Paginated<ProductSummary>>>({ queryKey: ['feed'] }, (data) =>
        data
          ? { ...data, pages: data.pages.map((pg) => ({ ...pg, items: pg.items.map(patch) })) }
          : data,
      );
      qc.setQueryData<ProductDetail>(keys.product(productId), (d) =>
        d ? { ...d, isFavorite: favorite } : d,
      );
    },
    onSettled: (_d, _e, { productId }) => {
      void qc.invalidateQueries({ queryKey: keys.favorites });
      void qc.invalidateQueries({ queryKey: keys.product(productId) });
    },
  });
}

export const useStories = () =>
  useQuery({ queryKey: keys.stories, queryFn: () => api.request<StoryGroupDto[]>('/stories') });

export const useConversations = () =>
  useInfiniteQuery({
    queryKey: keys.conversations,
    queryFn: ({ pageParam }) =>
      api.request<Paginated<ConversationDto>>('/conversations', { query: { cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

export const useConversation = (id: string) =>
  useQuery({
    queryKey: keys.conversation(id),
    queryFn: () => api.request<ConversationDto>(`/conversations/${id}`),
  });

export const useMessages = (id: string) =>
  useInfiniteQuery({
    queryKey: keys.messages(id),
    queryFn: ({ pageParam }) =>
      api.request<Paginated<MessageDto>>(`/conversations/${id}/messages`, {
        query: { cursor: pageParam, limit: 30 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

export const useUnreadCount = (enabled: boolean) =>
  useQuery({
    queryKey: keys.unread,
    queryFn: () => api.request<{ count: number }>('/conversations/unread-count'),
    enabled,
    refetchInterval: 60_000,
  });

export const useOrders = (role: 'buyer' | 'seller') =>
  useInfiniteQuery({
    queryKey: keys.orders(role),
    queryFn: ({ pageParam }) =>
      api.request<Paginated<OrderDto>>('/orders', { query: { role, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

export const useOrder = (id: string, refetchInterval?: number | false) =>
  useQuery({
    queryKey: keys.order(id),
    queryFn: () => api.request<OrderDto>(`/orders/${id}`),
    refetchInterval,
  });

export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: keys.notifications,
    queryFn: ({ pageParam }) =>
      api.request<Paginated<NotificationDto> & { unread: number }>('/notifications', {
        query: { cursor: pageParam },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });

export const usePublicUser = (id: string) =>
  useQuery({ queryKey: keys.user(id), queryFn: () => api.request<PublicUser>(`/users/${id}`) });

export const useUserProducts = (sellerId: string) =>
  useQuery({
    queryKey: keys.userProducts(sellerId),
    queryFn: () =>
      api.request<Paginated<ProductSummary>>('/products', { query: { sellerId, limit: 50 } }),
  });

export const useSoldProducts = (sellerId: string) =>
  useQuery({
    queryKey: keys.sold(sellerId),
    queryFn: () => api.request<ProductSummary[]>(`/products/sold/${sellerId}`),
  });

export const useReviews = (userId: string) =>
  useQuery({
    queryKey: keys.reviews(userId),
    queryFn: () => api.request<Paginated<ReviewDto>>(`/users/${userId}/reviews`),
  });

export const useMyProducts = (status?: string) =>
  useQuery({
    queryKey: keys.myProducts(status),
    queryFn: () =>
      api.request<Paginated<ProductSummary>>('/products/mine', { query: { status, limit: 50 } }),
  });

export const useOffers = (role: 'buyer' | 'seller', productId?: string) =>
  useQuery({
    queryKey: keys.offers(role, productId),
    queryFn: () => api.request<OfferDto[]>('/offers', { query: { role, productId } }),
  });

export function flatten<T>(data: InfiniteData<Paginated<T>> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}
