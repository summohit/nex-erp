import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * Global so any feature module can inject CryptoService without repeating the
 * import — it holds no request state, and the alternative is threading the same
 * import through every module that ever needs to encrypt a column.
 */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
