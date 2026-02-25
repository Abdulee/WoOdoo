"""add_retry_count_to_sync_logs

Revision ID: 0002
Revises: 0001
Create Date: 2026-02-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add retry_count column to sync_logs table
    op.add_column(
        'sync_logs',
        sa.Column('retry_count', sa.Integer(), server_default='0', nullable=False),
    )

    # Add status column to sync_logs table for retry/review queue tracking
    op.add_column(
        'sync_logs',
        sa.Column('status', sa.String(50), nullable=True),
    )

    # Add new values to syncstatusenum for PostgreSQL native enums
    # These are needed for the retry/review queue feature
    op.execute("ALTER TYPE syncstatusenum ADD VALUE IF NOT EXISTS 'failed_permanent'")
    op.execute("ALTER TYPE syncstatusenum ADD VALUE IF NOT EXISTS 'dismissed'")

def downgrade() -> None:
    op.drop_column('sync_logs', 'status')
    op.drop_column('sync_logs', 'retry_count')
    # Note: PostgreSQL does not support removing enum values in a simple ALTER TYPE.
    # The new enum values 'failed_permanent' and 'dismissed' will remain.
