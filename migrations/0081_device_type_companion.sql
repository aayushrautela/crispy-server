-- Companion (local torrent engine) devices share the RFC 8628 device grant
-- with TV login. Allow device_type 'companion' for rows minted from
-- client_id 'crispy-companion'.
ALTER TABLE private.devices DROP CONSTRAINT devices_device_type_check;
ALTER TABLE private.devices
  ADD CONSTRAINT devices_device_type_check
  CHECK (device_type IN ('tv', 'mobile', 'web', 'desktop', 'companion'));
