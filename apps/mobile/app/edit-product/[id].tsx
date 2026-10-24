import { router, useLocalSearchParams } from 'expo-router';
import { ErrorView, Header, LoadingView, Screen } from '../../src/components/ui';
import { ProductForm } from '../../src/features/ProductForm';
import { useProduct } from '../../src/hooks/queries';

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);
  return (
    <Screen>
      <Header title="Modifier l’annonce" onBack={() => router.back()} />
      {product.isLoading ? (
        <LoadingView />
      ) : product.data ? (
        <ProductForm product={product.data} />
      ) : (
        <ErrorView message="Annonce introuvable" onRetry={() => product.refetch()} />
      )}
    </Screen>
  );
}
