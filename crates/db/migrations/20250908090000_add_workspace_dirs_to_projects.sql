-- Add workspace_dirs column to projects for monorepo workspace handling
ALTER TABLE projects ADD COLUMN workspace_dirs TEXT;

