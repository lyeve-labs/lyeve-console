/**
 * What a relation field's picker is fed. The server reads it, and the form
 * only renders it.
 */
import type { Content } from '@lyeve-labs/client';

export type RelationChoices = {
	items: Content[];
	/** How many entries the related collection holds, as the listing counted them. */
	total: number;
	/** Whether the read failed, so `items` is empty for no reason the collection gave. */
	failed: boolean;
	/**
	 * The name an assistant reads for each entry, by id. Set when the related
	 * type marks a field No AI or private, because the name a person sees may
	 * be that field's value.
	 */
	assistantLabels?: Record<string, string>;
};
