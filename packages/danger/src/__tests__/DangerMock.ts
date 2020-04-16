// Provides dev-time typing structure for  `danger` - doesn't affect runtime.
import { DangerDSLType } from 'danger/distribution/dsl/DangerDSL';

export function getDangerMock(): DangerDSLType {
  return {} as DangerDSLType;
}
