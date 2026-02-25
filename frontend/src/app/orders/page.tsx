import { PageContainer } from '@/components/layout/PageContainer'

export default function OrdersPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Orders</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        Monitor and sync WooCommerce orders back to Odoo, view order mapping status.
      </p>
    </PageContainer>
  )
}
