import type { GenerationSource, GenerationSourceResolver } from "./types.js";

export const defaultGenerationSourceResolver: GenerationSourceResolver = (source: GenerationSource) => {
  switch (source.type) {
    case "url":
      return source.url;
    case "base64":
      return `data:${source.mediaType};base64,${source.data}`;
  }
};
