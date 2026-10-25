import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/WTHT3'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq1Device, buf } from '@/tests/helpers/mocks'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'WTHT3'
const META: Metadata = { modelId: MODEL_ID, modelName: 'WTHT3', swVersion: '1.0' }

// Packed from a WTHT3 status snapshot the LG cloud reported (decoded there against LG's modelJson):
// Measuring, Wash+Dry, remaining 2:12 of 4:04, Normal Dry, door locked, PreState Drying, TCLCount 49.
const SAMPLE_STATE_WASH_DRY_MEASURING = buf(
    '04 02 0c 04 04 13 00 00 00 00 00 02 00 00 00 40 00 00 00 09 00 31 00 00 00 00 00 00',
)
// Synthetic: Drying, downloaded course Turbo Dry (0x45 at byte 20) overriding base course Cotton,
// Time Dry 60 min, 0:45 left, door locked.
const SAMPLE_STATE_DRYING_SMART_TURBO_DRY = buf(
    '09 00 2d 01 00 01 00 00 00 00 00 04 00 00 00 40 00 00 00 08 45 31 00 00 00 00 00 00',
)
// Synthetic: End of a plain Cotton wash, no drying (DryLevel 1 is the second "-" code), door unlocked.
const SAMPLE_STATE_END_COTTON_NO_DRY = buf(
    '0a 00 00 01 30 01 00 03 09 04 01 01 00 00 00 00 00 00 00 08 00 32 00 00 00 00 00 00',
)

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq1Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('wash+dry snapshot decodes course, dry level, times and lock', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_STATE_WASH_DRY_MEASURING)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.power, 'ON')
        assert.equal(props.status, 'Measuring')
        assert.equal(props.course, 'Wash+Dry')
        assert.equal(props.dry_level, 'Normal Dry')
        assert.equal(props.remaining_time, 132)
        assert.equal(props.initial_time, 244)
        assert.equal(props.error, 'OFF')
        assert.equal(props.error_message, 'OK')
        assert.equal(props.door_lock, 'OFF') // OFF means locked
        assert.equal(props.tub_clean_count, 49)
    })

    test('downloaded dry course overrides the base course', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_STATE_DRYING_SMART_TURBO_DRY)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Drying')
        assert.equal(props.course, 'Turbo Dry')
        assert.equal(props.dry_level, 'Time Dry 60 min')
        assert.equal(props.remaining_time, 45)
    })

    test('end of a wash without drying', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_STATE_END_COTTON_NO_DRY)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'End')
        assert.equal(props.course, 'Cotton')
        assert.equal(props.dry_level, 'Off')
        assert.equal(props.spin, '1200 rpm')
        assert.equal(props.temp, '40 °C')
        assert.equal(props.door_lock, 'ON') // unlocked
        assert.equal(props.tub_clean_count, 50)
    })

    test('ignores frames that are not 28 bytes', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', buf('0102'))
        assert.deepEqual(ha.devices[DEVICE_ID].properties, {})
    })
})
