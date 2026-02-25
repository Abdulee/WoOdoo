import { PageContainer } from '@/components/layout/PageContainer'

export default function NewSyncJobPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>New Sync Job</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        Configure and create a new bidirectional product sync job with custom field mappings and filters.
      </p>
    </PageContainer>
  )
}
