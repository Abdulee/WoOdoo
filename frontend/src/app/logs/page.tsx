import { PageContainer } from '@/components/layout/PageContainer'

export default function SyncLogsPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Sync Logs</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        View detailed logs from all sync executions, filter by job, status, or date range.
      </p>
    </PageContainer>
  )
}
