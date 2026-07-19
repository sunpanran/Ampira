import { imageMeetsProfileDimensions } from "../../extension/core/image-candidates.mjs";

export function browserImageMeetsProfileDimensions(image, profile = "visual") {
  return imageMeetsProfileDimensions(image?.naturalWidth, image?.naturalHeight, profile);
}
