import { PageContainer } from '@/components/layout/PageContainer'

export default function SyncJobsPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Sync Jobs</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        View and manage all sync job configurations, trigger manual runs, and monitor execution status.
      </p>
    </PageContainer>
  )
}
