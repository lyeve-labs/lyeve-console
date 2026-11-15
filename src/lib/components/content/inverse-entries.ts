/**
 * What a has_one or has_many field's panel shows. The key lives on the other
 * content type, so the server reads the entries that point back, and the form
 * only renders them.
 */
export type InverseEntry = { id: string; label: string; href: string };

export type InverseEntries =
	| {
			state: 'read';
			/** The first entries that point back, each with the address of its editor. */
			items: InverseEntry[];
			/** How many entries point back, as the listing counted them. */
			total: number;
			/** The other content type's list filtered to these entries, when there are more than `items`. */
			listHref: string | null;
	  }
	/** No key on the other content type can be read for this relation. */
	| { state: 'unresolved' }
	/** The other content type or its entries could not be read. */
	| { state: 'failed' };
