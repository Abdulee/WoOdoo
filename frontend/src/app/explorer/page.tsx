import { PageContainer } from '@/components/layout/PageContainer'

export default function ProductExplorerPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Product Explorer</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        Browse and compare products between Odoo and WooCommerce, view mapping status and field diffs.
      </p>
    </PageContainer>
  )
}
