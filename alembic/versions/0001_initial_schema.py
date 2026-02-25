"""initial_schema

Revision ID: 0001
Revises: 
Create Date: 2026-02-25 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types
    connectionstatus_enum = postgresql.ENUM('active', 'inactive', 'degraded', name='connectionstatus')
    connectionstatus_enum.create(op.get_bind())
    
    platformenum = postgresql.ENUM('odoo', 'woocommerce', name='platformenum')
    platformenum.create(op.get_bind())
    
    syncdirectionenum = postgresql.ENUM('odoo_to_wc', 'wc_to_odoo', 'bidirectional', name='syncdirectionenum')
    syncdirectionenum.create(op.get_bind())
    
    syncoriginenum = postgresql.ENUM('odoo', 'woocommerce', 'woodoo', name='syncoriginenum')
    syncoriginenum.create(op.get_bind())
    
    syncstatusenum = postgresql.ENUM('synced', 'pending', 'failed', 'review', name='syncstatusenum')
    syncstatusenum.create(op.get_bind())
    
    executionstatusenum = postgresql.ENUM('running', 'completed', 'failed', 'cancelled', name='executionstatusenum')
    executionstatusenum.create(op.get_bind())
    
    loglevelenum = postgresql.ENUM('info', 'warning', 'error', name='loglevelenum')
    loglevelenum.create(op.get_bind())
    
    ordersyncstatusenum = postgresql.ENUM('synced', 'pending', 'failed', name='ordersyncstatusenum')
    ordersyncstatusenum.create(op.get_bind())

    # Create connections table
    op.create_table(
        'connections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('platform', postgresql.ENUM('odoo', 'woocommerce', name='platformenum'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('config_encrypted', sa.Text(), nullable=False),
        sa.Column('status', postgresql.ENUM('active', 'inactive', 'degraded', name='connectionstatus'), server_default='active', nullable=False),
        sa.Column('last_tested_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # Create sync_jobs table
    op.create_table(
        'sync_jobs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('direction', postgresql.ENUM('odoo_to_wc', 'wc_to_odoo', 'bidirectional', name='syncdirectionenum'), nullable=False),
        sa.Column('filters', postgresql.JSONB(), server_default='{}', nullable=False),
        sa.Column('field_mappings', postgresql.JSONB(), server_default='[]', nullable=False),
        sa.Column('schedule_config', postgresql.JSONB(), nullable=True),
        sa.Column('lifecycle_config', postgresql.JSONB(), nullable=True),
        sa.Column('is_enabled', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('connection_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['connection_id'], ['connections.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create product_mappings table
    op.create_table(
        'product_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('odoo_template_id', sa.Integer(), nullable=False),
        sa.Column('odoo_product_id', sa.Integer(), nullable=True),
        sa.Column('woo_product_id', sa.Integer(), nullable=True),
        sa.Column('woo_variation_id', sa.Integer(), nullable=True),
        sa.Column('field_hashes', postgresql.JSONB(), server_default='{}', nullable=False),
        sa.Column('sync_origin', postgresql.ENUM('odoo', 'woocommerce', 'woodoo', name='syncoriginenum'), server_default='woodoo', nullable=False),
        sa.Column('sync_status', postgresql.ENUM('synced', 'pending', 'failed', 'review', name='syncstatusenum'), server_default='pending', nullable=False),
        sa.Column('last_synced_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_product_mappings_odoo_template_id', 'product_mappings', ['odoo_template_id'])
    op.create_index('ix_product_mappings_woo_product_id', 'product_mappings', ['woo_product_id'])

    # Create category_mappings table
    op.create_table(
        'category_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('odoo_category_id', sa.Integer(), nullable=False),
        sa.Column('woo_category_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('odoo_category_id')
    )

    # Create attribute_mappings table
    op.create_table(
        'attribute_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('odoo_attribute_id', sa.Integer(), nullable=False),
        sa.Column('woo_attribute_id', sa.Integer(), nullable=True),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('odoo_attribute_id')
    )

    # Create image_mappings table
    op.create_table(
        'image_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_mapping_id', sa.Integer(), nullable=False),
        sa.Column('odoo_image_hash', sa.String(64), nullable=False),
        sa.Column('wp_media_id', sa.Integer(), nullable=True),
        sa.Column('woo_image_url', sa.Text(), nullable=True),
        sa.Column('woo_image_position', sa.Integer(), server_default='0', nullable=False),
        sa.Column('last_synced_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['product_mapping_id'], ['product_mappings.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create sync_executions table
    op.create_table(
        'sync_executions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('job_id', sa.Integer(), nullable=False),
        sa.Column('status', postgresql.ENUM('running', 'completed', 'failed', 'cancelled', name='executionstatusenum'), server_default='running', nullable=False),
        sa.Column('started_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.Column('total_products', sa.Integer(), server_default='0', nullable=False),
        sa.Column('synced_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('error_count', sa.Integer(), server_default='0', nullable=False),
        sa.Column('skipped_count', sa.Integer(), server_default='0', nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['sync_jobs.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sync_executions_job_started', 'sync_executions', ['job_id', 'started_at'])

    # Create sync_logs table
    op.create_table(
        'sync_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('execution_id', sa.Integer(), nullable=False),
        sa.Column('product_mapping_id', sa.Integer(), nullable=True),
        sa.Column('level', postgresql.ENUM('info', 'warning', 'error', name='loglevelenum'), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('details', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['execution_id'], ['sync_executions.id'], ),
        sa.ForeignKeyConstraint(['product_mapping_id'], ['product_mappings.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sync_logs_execution_created', 'sync_logs', ['execution_id', 'created_at'])

    # Create order_mappings table
    op.create_table(
        'order_mappings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('woo_order_id', sa.Integer(), nullable=False),
        sa.Column('odoo_order_id', sa.Integer(), nullable=True),
        sa.Column('sync_status', postgresql.ENUM('synced', 'pending', 'failed', name='ordersyncstatusenum'), server_default='pending', nullable=False),
        sa.Column('last_synced_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('woo_order_id')
    )

    # Create settings table
    op.create_table(
        'settings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(255), nullable=False),
        sa.Column('value', postgresql.JSONB(), server_default='{}', nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key')
    )


def downgrade() -> None:
    op.drop_table('settings')
    op.drop_table('order_mappings')
    op.drop_index('ix_sync_logs_execution_created')
    op.drop_table('sync_logs')
    op.drop_index('ix_sync_executions_job_started')
    op.drop_table('sync_executions')
    op.drop_table('image_mappings')
    op.drop_table('attribute_mappings')
    op.drop_table('category_mappings')
    op.drop_index('ix_product_mappings_woo_product_id')
    op.drop_index('ix_product_mappings_odoo_template_id')
    op.drop_table('product_mappings')
    op.drop_table('sync_jobs')
    op.drop_table('connections')
    
    # Drop enum types
    postgresql.ENUM('ordersyncstatusenum').drop(op.get_bind())
    postgresql.ENUM('loglevelenum').drop(op.get_bind())
    postgresql.ENUM('executionstatusenum').drop(op.get_bind())
    postgresql.ENUM('syncstatusenum').drop(op.get_bind())
    postgresql.ENUM('syncoriginenum').drop(op.get_bind())
    postgresql.ENUM('syncdirectionenum').drop(op.get_bind())
    postgresql.ENUM('platformenum').drop(op.get_bind())
    postgresql.ENUM('connectionstatus').drop(op.get_bind())
