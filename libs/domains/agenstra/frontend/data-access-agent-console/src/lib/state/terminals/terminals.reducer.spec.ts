import {
  terminalClosedReceived,
  terminalCreatedReceived,
  terminalOutputReceived,
  terminalsClear,
} from './terminals.actions';
import { initialTerminalsState, terminalsReducer, type TerminalsState } from './terminals.reducer';

describe('terminalsReducer', () => {
  describe('initial state', () => {
    it('should return the initial state', () => {
      const state = terminalsReducer(undefined, { type: '[Terminals] Unknown' });

      expect(state).toEqual(initialTerminalsState);
      expect(state.maxOutputChunks).toBe(200);
      expect(state.nextSeq).toBe(0);
    });
  });

  describe('terminalCreatedReceived', () => {
    it('should register a session as open', () => {
      const state = terminalsReducer(initialTerminalsState, terminalCreatedReceived({ sessionId: 's1' }));

      expect(state.sessions['s1']).toEqual({ sessionId: 's1', status: 'open' });
    });

    it('should reopen a previously closed session', () => {
      const preexisting: TerminalsState = {
        ...initialTerminalsState,
        sessions: { s1: { sessionId: 's1', status: 'closed' } },
      };
      const state = terminalsReducer(preexisting, terminalCreatedReceived({ sessionId: 's1' }));

      expect(state.sessions['s1'].status).toBe('open');
    });
  });

  describe('terminalOutputReceived', () => {
    it('should append a chunk with monotonic seq and increment nextSeq', () => {
      let state = terminalsReducer(initialTerminalsState, terminalOutputReceived({ sessionId: 's1', data: 'hello' }));

      expect(state.outputChunks).toEqual([{ seq: 0, sessionId: 's1', data: 'hello' }]);
      expect(state.nextSeq).toBe(1);

      state = terminalsReducer(state, terminalOutputReceived({ sessionId: 's1', data: ' world' }));

      expect(state.outputChunks).toHaveLength(2);
      expect(state.outputChunks[1]).toEqual({ seq: 1, sessionId: 's1', data: ' world' });
      expect(state.nextSeq).toBe(2);
    });

    it('should trim outputChunks to maxOutputChunks', () => {
      const max = initialTerminalsState.maxOutputChunks;
      let state = initialTerminalsState;

      for (let i = 0; i < max + 5; i++) {
        state = terminalsReducer(state, terminalOutputReceived({ sessionId: 's1', data: `c${i}` }));
      }

      expect(state.outputChunks).toHaveLength(max);
      expect(state.outputChunks[0].data).toBe('c5');
      expect(state.outputChunks[max - 1].data).toBe(`c${max + 4}`);
      expect(state.nextSeq).toBe(max + 5);
    });
  });

  describe('terminalClosedReceived', () => {
    it('should mark an existing session as closed and leave chunks', () => {
      let state = terminalsReducer(initialTerminalsState, terminalCreatedReceived({ sessionId: 's1' }));

      state = terminalsReducer(state, terminalOutputReceived({ sessionId: 's1', data: 'x' }));
      state = terminalsReducer(state, terminalClosedReceived({ sessionId: 's1' }));

      expect(state.sessions['s1']).toEqual({ sessionId: 's1', status: 'closed' });
      expect(state.outputChunks).toHaveLength(1);
    });

    it('should record a closed session that was never created', () => {
      const state = terminalsReducer(initialTerminalsState, terminalClosedReceived({ sessionId: 'orphan' }));

      expect(state.sessions['orphan']).toEqual({ sessionId: 'orphan', status: 'closed' });
    });
  });

  describe('terminalsClear', () => {
    it('should reset to initial state', () => {
      let state = terminalsReducer(initialTerminalsState, terminalCreatedReceived({ sessionId: 's1' }));

      state = terminalsReducer(state, terminalOutputReceived({ sessionId: 's1', data: 'x' }));
      state = terminalsReducer(state, terminalsClear());

      expect(state).toEqual(initialTerminalsState);
    });
  });
});
