-- Add optional project-level prompt instructions appended to every task prompt
ALTER TABLE projects
  ADD COLUMN append_prompt TEXT;

