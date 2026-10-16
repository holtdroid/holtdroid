package auth

import (
	"crypto/rand"
	"math/big"
	"strings"
)

var (
	sizes = []string{
		"big", "small", "tiny", "huge", "little", "giant", "chubby", "lanky", "fluffy", "round",
		"mini", "mighty", "plump", "slim", "bouncy", "stocky", "wee", "grand", "pocket", "long",
	}
	moods = []string{
		"cute", "brave", "calm", "clever", "cozy", "curious", "eager", "fancy", "gentle", "happy",
		"jolly", "kind", "lucky", "merry", "nimble", "playful", "proud", "quick", "quiet", "shy",
		"silly", "sleepy", "sneaky", "sunny", "swift", "witty", "zesty", "dapper", "plucky", "snug",
	}
	animals = []string{
		"otter", "beaver", "badger", "fox", "panda", "koala", "lynx", "marten", "meerkat", "mink",
		"mole", "moose", "narwhal", "ocelot", "owl", "penguin", "puffin", "quokka", "raccoon", "seal",
		"sloth", "squirrel", "stoat", "tapir", "walrus", "weasel", "wombat", "yak", "axolotl", "capybara",
		"dolphin", "ferret", "gecko", "hedgehog", "ibis", "jackal", "kiwi", "lemur", "manatee", "platypus",
	}
)

func pick(words []string) string {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(words))))
	if err != nil {
		panic(err)
	}
	return words[n.Int64()]
}

// RandomName returns a friendly random handle such as "big-cute-otter".
func RandomName() string {
	return strings.Join([]string{pick(sizes), pick(moods), pick(animals)}, "-")
}
