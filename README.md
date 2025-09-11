## Home Assistant Integration

This add-on now publishes its playback state into Home Assistant:

- **Binary sensor** (default: `binary_sensor.ring_livestream_playing`)  
  - `on` when the livestream is running  
  - `off` when stopped or errored  
  - Attributes include camera name, codec, quality, and playlist URL

- **Events** (prefix configurable, default `ring_livestream`)  
  - `ring_livestream_started` — fired when the stream successfully begins  
  - `ring_livestream_stopped` — fired when the stream ends or stalls  

You can use these in automations:

```yaml
# Example: notify when stream starts
automation:
  - alias: Notify Ring Stream
    trigger:
      - platform: state
        entity_id: binary_sensor.ring_livestream_playing
        to: 'on'
    action:
      - service: notify.mobile_app_pixel_7
        data:
          message: >
            Ring stream started: {{
              state_attr('binary_sensor.ring_livestream_playing','camera')
            }}
