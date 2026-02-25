import { PageContainer } from '@/components/layout/PageContainer'

export default function SettingsPage() {
  return (
    <PageContainer>
      <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>Settings</h1>
      <p className="mt-2" style={{ color: 'var(--muted-foreground)' }}>
        Configure global application settings, webhook URLs, and sync preferences.
      </p>
    </PageContainer>
  )
}
