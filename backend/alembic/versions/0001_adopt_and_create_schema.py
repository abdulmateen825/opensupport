"""Create missing OpenSupport tables and adopt the prior local MVP schema.

Revision ID: 0001_adopt_schema
Revises:
"""
from alembic import op

from backend.app.models import Base

revision = "0001_adopt_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_all is safe here because it only creates absent tables; the SQL
    # below adds columns that the previous single-tenant MVP did not have.
    Base.metadata.create_all(bind=op.get_bind())
    op.execute("""
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
          ADD COLUMN IF NOT EXISTS allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb
    """)
    op.execute("""
        INSERT INTO organizations (id, name, retention_days, created_at)
        SELECT '00000000-0000-0000-0000-000000000001', 'Legacy workspace', 365, now()
        WHERE EXISTS (SELECT 1 FROM projects WHERE organization_id IS NULL)
        ON CONFLICT (id) DO NOTHING
    """)
    op.execute("""
        UPDATE projects SET organization_id = '00000000-0000-0000-0000-000000000001'
        WHERE organization_id IS NULL
    """)
    op.execute("ALTER TABLE projects ALTER COLUMN organization_id SET NOT NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_projects_organization_id ON projects (organization_id)")
    op.execute("""
        ALTER TABLE conversations
          ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(120),
          ADD COLUMN IF NOT EXISTS escalation_reason VARCHAR(240),
          ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(160),
          ADD COLUMN IF NOT EXISTS visitor_verified BOOLEAN NOT NULL DEFAULT FALSE
    """)
    op.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(120)")
    op.execute("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ")


def downgrade() -> None:
    # This adoption migration may contain user data. Rollbacks must be planned
    # as forward migrations or restored from a backup, never destructive drops.
    raise RuntimeError("The schema adoption migration is intentionally irreversible")
