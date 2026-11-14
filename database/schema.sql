-- Sorgente dello schema: applicare in sviluppo.
-- In produzione il flusso Publish di Replit applica il confronto degli schemi.
CREATE TABLE IF NOT EXISTS public.chef_on_board_store (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
