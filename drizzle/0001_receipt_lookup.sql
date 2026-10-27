-- Additive lookup index for public receipt pagination. Existing rows are unchanged.
CREATE INDEX IF NOT EXISTS `mining_shares_receipt_order` ON `mining_shares` (`accepted` DESC, `id` DESC);
