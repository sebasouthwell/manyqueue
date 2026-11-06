-- Rotation turns now come in rounds: credit is the turns a guest has left in the current round.
-- Old credit values meant something else, so everyone starts the switch-over owed one turn.
UPDATE `rotation_state` SET `credit` = 1;
