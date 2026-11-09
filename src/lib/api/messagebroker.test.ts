import { describe, expect, it } from 'vitest';
import {
	backendLabel,
	brokerHealth,
	deliveryRate,
	hasBroker,
	healthTone,
	type BrokerStatus,
} from './messagebroker';

function status(over: Partial<BrokerStatus> = {}): BrokerStatus {
	return {
		backend: 'nats',
		connected: true,
		degraded: false,
		target: 'nats://broker.example.com:4222',
		tls: true,
		published: 100,
		failed: 0,
		dropped: 0,
		...over,
	};
}

describe('the one sentence the page leads with', () => {
	// A plugin the instance does not enable drops every event on purpose.
	// Calling it a broker failure sends somebody to look at infrastructure
	// that is working.
	it('puts a disabled plugin ahead of everything else', () => {
		expect(brokerHealth(status({ degraded: true, failed: 9, dropped: 9 }))).toBe('disabled');
		expect(healthTone('disabled')).toBe('warn');
	});

	it('puts a refusing broker ahead of an undelivered event', () => {
		expect(brokerHealth(status({ failed: 1, dropped: 5 }))).toBe('refusing');
		expect(brokerHealth(status({ failed: 0, dropped: 5 }))).toBe('undelivered');
		expect(healthTone('refusing')).toBe('danger');
	});

	// A fresh install has published nothing, which is correct and must not
	// read as a fault.
	it('reads refused attempts through the outbox, where only dead events are lost', () => {
		const outbox = { enabled: true, available: true, pending: 0, dead: 0 };
		expect(brokerHealth(status({ failed: 3, published: 10, outbox }))).toBe('publishing');
		expect(brokerHealth(status({ failed: 3, outbox: { ...outbox, pending: 2 } }))).toBe('retrying');
		expect(brokerHealth(status({ failed: 0, outbox: { ...outbox, dead: 1 } }))).toBe('lost');
		expect(brokerHealth(status({ failed: 3, outbox: { ...outbox, available: false } }))).toBe('retrying');
		expect(brokerHealth(status({ failed: 3, outbox: { ...outbox, enabled: false } }))).toBe('refusing');
	});

	it('says nothing published rather than healthy on a fresh install', () => {
		expect(brokerHealth(status({ published: 0 }))).toBe('idle');
		expect(brokerHealth(null)).toBe('idle');
		expect(healthTone('idle')).toBe('neutral');
	});

	// With no broker the plugin counts every discarded event as published.
	it('says events are discarded when no broker is set, whatever the counters say', () => {
		expect(brokerHealth(status({ backend: '', published: 25 }))).toBe('discarding');
		expect(brokerHealth(status({ backend: 'noop', published: 0 }))).toBe('discarding');
		expect(brokerHealth(status({ backend: '', degraded: true }))).toBe('disabled');
		expect(healthTone('discarding')).toBe('warn');
	});

	it('says publishing when events are getting through', () => {
		expect(brokerHealth(status())).toBe('publishing');
		expect(healthTone('publishing')).toBe('success');
	});
});

describe('the delivery rate', () => {
	it('counts every attempt, not just the failures', () => {
		expect(deliveryRate(status({ published: 90, failed: 5, dropped: 5 }))).toBe(90);
		expect(deliveryRate(status({ published: 1, failed: 2, dropped: 0 }))).toBe(33.3);
	});

	// Delivering none of nothing is not perfect delivery, and stating it as
	// 100% is the reading this page exists to prevent.
	it('reports nothing rather than perfect when nothing was attempted', () => {
		expect(deliveryRate(status({ published: 0, failed: 0, dropped: 0 }))).toBeNull();
		expect(deliveryRate(null)).toBeNull();
	});

	it('reports nothing when there is no broker to reach', () => {
		expect(deliveryRate(status({ backend: '', published: 25 }))).toBeNull();
		expect(deliveryRate(status({ backend: 'noop', published: 25 }))).toBeNull();
		expect(hasBroker(status({ backend: 'kafka' }))).toBe(true);
		expect(hasBroker(null)).toBe(false);
	});
});

describe('naming the backend', () => {
	it('uses the product name, and says so when none is configured', () => {
		expect(backendLabel('nats')).toBe('NATS JetStream');
		expect(backendLabel('kafka')).toBe('Apache Kafka');
		expect(backendLabel('rabbitmq')).toBe('RabbitMQ');
		expect(backendLabel('')).toBe('No broker configured');
		expect(backendLabel('noop')).toBe('No broker configured');
	});

	it('prints a backend it does not know rather than hiding it', () => {
		expect(backendLabel('pulsar')).toBe('pulsar');
	});
});
