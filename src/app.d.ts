declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * What a refusal is about, by the name the reader sees, such as a
			 * content type's display name. The page that draws the refusal
			 * titles itself with it.
			 */
			subject?: string;
		}
	}
}

export {};
